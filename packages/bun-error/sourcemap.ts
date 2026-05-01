// Accelerate VLQ decoding with a lookup table
const vlqTable = new Uint8Array(128);
const vlqChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
vlqTable.fill(0xff);
for (let i = 0; i < vlqChars.length; i++) vlqTable[vlqChars.charCodeAt(i)] = i;

export function parseSourceMap(json) {
  if (json.version !== 3) {
    throw new Error("Invalid source map");
  }

  if (!(json.sources instanceof Array) || json.sources.some(x => typeof x !== "string")) {
    throw new Error("Invalid source map");
  }

  if (typeof json.mappings !== "string") {
    throw new Error("Invalid source map");
  }

  const { sources, sourcesContent, names, mappings } = json;
  const emptyData = new Int32Array(0);
  for (let i = 0; i < sources.length; i++) {
    sources[i] = {
      name: sources[i],
      content: (sourcesContent && sourcesContent[i]) || "",
      data: emptyData,
      dataLength: 0,
    };
  }
  const data = decodeMappings(mappings, sources.length);
  return { sources, names, data };
}

// ripped from https://github.com/evanw/source-map-visualization/blob/gh-pages/code.js#L179
export function decodeMappings(mappings, sourcesCount) {
  const n = mappings.length;
  let data = new Int32Array(1024);
  let dataLength = 0;
  let generatedLine = 0;
  let generatedLineStart = 0;
  let generatedColumn = 0;
  let originalSource = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let originalName = 0;
  let needToSortGeneratedColumns = false;
  let i = 0;

  function decodeError(text) {
    const error = `Invalid VLQ data at index ${i}: ${text}`;
    throw new Error(error);
  }

  function decodeVLQ() {
    let shift = 0;
    let vlq = 0;

    // Scan over the input
    while (true) {
      // Read a byte
      if (i >= mappings.length) decodeError("Expected extra data");
      const c = mappings.charCodeAt(i);
      if ((c & 0x7f) !== c) decodeError("Invalid character");
      const index = vlqTable[c & 0x7f];
      if (index === 0xff) decodeError("Invalid character");
      i++;

      // Decode the byte
      vlq |= (index & 31) << shift;
      shift += 5;

      // Stop if there's no continuation bit
      if ((index & 32) === 0) break;
    }

    // Recover the signed value
    return vlq & 1 ? -(vlq >> 1) : vlq >> 1;
  }

  while (i < n) {
    let c = mappings.charCodeAt(i);

    // Handle a line break
    if (c === 59 /* ; */) {
      // The generated columns are very rarely out of order. In that case,
      // sort them with insertion since they are very likely almost ordered.
      if (needToSortGeneratedColumns) {
        for (let j = generatedLineStart + 6; j < dataLength; j += 6) {
          const genL = data[j];
          const genC = data[j + 1];
          const origS = data[j + 2];
          const origL = data[j + 3];
          const origC = data[j + 4];
          const origN = data[j + 5];
          let k = j - 6;
          for (; k >= generatedLineStart && data[k + 1] > genC; k -= 6) {
            data[k + 6] = data[k];
            data[k + 7] = data[k + 1];
            data[k + 8] = data[k + 2];
            data[k + 9] = data[k + 3];
            data[k + 10] = data[k + 4];
            data[k + 11] = data[k + 5];
          }
          data[k + 6] = genL;
          data[k + 7] = genC;
          data[k + 8] = origS;
          data[k + 9] = origL;
          data[k + 10] = origC;
          data[k + 11] = origN;
        }
      }

      generatedLine++;
      generatedColumn = 0;
      generatedLineStart = dataLength;
      needToSortGeneratedColumns = false;
      i++;
      continue;
    }

    // Ignore stray commas
    if (c === 44 /* , */) {
      i++;
      continue;
    }

    // Read the generated column
    const generatedColumnDelta = decodeVLQ();
    if (generatedColumnDelta < 0) needToSortGeneratedColumns = true;
    generatedColumn += generatedColumnDelta;
    if (generatedColumn < 0) decodeError("Invalid generated column");

    // It's valid for a mapping to have 1, 4, or 5 variable-length fields
    let isOriginalSourceMissing = true;
    let isOriginalNameMissing = true;
    if (i < n) {
      c = mappings.charCodeAt(i);
      if (c === 44 /* , */) {
        i++;
      } else if (c !== 59 /* ; */) {
        isOriginalSourceMissing = false;

        // Read the original source
        const originalSourceDelta = decodeVLQ();
        originalSource += originalSourceDelta;
        if (originalSource < 0 || originalSource >= sourcesCount) decodeError("Invalid original source");

        // Read the original line
        const originalLineDelta = decodeVLQ();
        originalLine += originalLineDelta;
        if (originalLine < 0) decodeError("Invalid original line");

        // Read the original column
        const originalColumnDelta = decodeVLQ();
        originalColumn += originalColumnDelta;
        if (originalColumn < 0) decodeError("Invalid original column");

        // Check for the optional name index
        if (i < n) {
          c = mappings.charCodeAt(i);
          if (c === 44 /* , */) {
            i++;
          } else if (c !== 59 /* ; */) {
            isOriginalNameMissing = false;

            // Read the optional name index
            const originalNameDelta = decodeVLQ();
            originalName += originalNameDelta;
            if (originalName < 0) decodeError("Invalid original name");

            // Handle the next character
            if (i < n) {
              c = mappings.charCodeAt(i);
              if (c === 44 /* , */) {
                i++;
              } else if (c !== 59 /* ; */) {
                decodeError("Invalid character after mapping");
              }
            }
          }
        }
      }
    }

    // Append the mapping to the typed array
    if (dataLength + 6 > data.length) {
      const newData = new Int32Array(data.length << 1);
      newData.set(data);
      data = newData;
    }
    data[dataLength] = generatedLine;
    data[dataLength + 1] = generatedColumn;
    if (isOriginalSourceMissing) {
      data[dataLength + 2] = -1;
      data[dataLength + 3] = -1;
      data[dataLength + 4] = -1;
    } else {
      data[dataLength + 2] = originalSource;
      data[dataLength + 3] = originalLine;
      data[dataLength + 4] = originalColumn;
    }
    data[dataLength + 5] = isOriginalNameMissing ? -1 : originalName;
    dataLength += 6;
  }

  return data.subarray(0, dataLength);
}

export function remapPosition(decodedMappings: Int32Array, line: number, column: number) {
  if (!(decodedMappings instanceof Int32Array)) {
    throw new Error("decodedMappings must be an Int32Array");
  }

  if (!Number.isFinite(line)) {
    throw new Error("line must be a finite number");
  }

  if (!Number.isFinite(column)) {
    throw new Error("column must be a finite number");
  }

  if (decodedMappings.length === 0 || line < 0 || column < 0) return null;

  const index = indexOfMapping(decodedMappings, line, column);
  if (index === -1) return null;

  return [decodedMappings[index + 3] + 1, decodedMappings[index + 4]];
}

async function fetchRemoteSourceMap(file: string, signal) {
  const response = await globalThis.fetch(file + ".map", {
    signal,
    headers: {
      Accept: "application/json",
      "Mappings-Only": "1",
    },
  });

  if (response.ok) {
    return await response.json();
  }

  return null;
}

export var sourceMappings = new Map();

export function fetchMappings(file, signal) {
  if (file.includes(".bun")) return null;
  if (sourceMappings.has(file)) {
    return sourceMappings.get(file);
  }

  return fetchRemoteSourceMap(file, signal).then(json => {
    if (!json) return null;
    const { data } = parseSourceMap(json);
    sourceMappings.set(file, data);
    return data;
  });
}

// this batches duplicate requests
export function fetchAllMappings(files, signal) {
  var results = new Array(files.length);
  var map = new Map();
  for (var i = 0; i < files.length; i++) {
    const existing = map.get(files[i]);
    if (existing) {
      existing.push(i);
    } else map.set(files[i], [i]);
  }

  for (const [file, indices] of [...map.entries()]) {
    const mapped = fetchMappings(file, signal);
    if (mapped?.then) {
      var resolvers = [];
      for (let i = 0; i < indices.length; i++) {
        results[indices[i]] = new Promise((resolve, reject) => {
          resolvers[i] = res => resolve(res ? [res, i] : null);
        });
      }

      mapped.finally(a => {
        for (let resolve of resolvers) {
          try {
            resolve(a);
          } catch {
          } finally {
          }
        }
        resolvers.length = 0;
        resolvers = null;
      });
    } else {
      for (let i = 0; i < indices.length; i++) {
        results[indices[i]] = mapped ? [mapped, indices[i]] : null;
      }
    }
  }

  return results;
}

function indexOfMapping(mappings: Int32Array, line: number, column: number) {
  // the array is [generatedLine, generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex]
  // 0 - generated line
  var count = mappings.length / 6;
  var index = 0;
  while (count > 0) {
    var step = (count / 2) | 0;
    var i = index + step;
    // this multiply is slow but it's okay for now
    var j = i * 6;
    if (mappings[j] < line || (mappings[j] == line && mappings[j + 1] <= column)) {
      index = i + 1;
      count -= step + 1;
    } else {
      count = step;
    }
  }

  index = index | 0;

  if (index > 0) {
    if (mappings[(index - 1) * 6] == line) {
      return (index - 1) * 6;
    }
  }

  return null;
}
