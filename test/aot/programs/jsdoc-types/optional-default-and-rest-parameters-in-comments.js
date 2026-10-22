/**
 * @param {number} a
 * @param {number} [b]
 * @returns {number}
 */
function bracketed(a, b) {
  return a + (b ?? 10);
}

/**
 * @param {number} a
 * @param {number=} b
 * @returns {number}
 */
function withEquals(a, b) {
  return a + (b === undefined ? 20 : b);
}

/**
 * @param {number} a
 * @param {number} [b=30]
 * @returns {number}
 */
function withDefaultInTheComment(a, b) {
  return a + (b ?? -1);
}

/**
 * @param {number} a
 * @param {number} [b]
 * @returns {number}
 */
function withDefaultInTheCode(a, b = 40) {
  return a + b;
}

/**
 * @param {number} first
 * @param {...number} rest
 * @returns {number}
 */
function summed(first, ...rest) {
  let total = first;
  for (const n of rest) total += n;
  return total;
}

/**
 * @param {object} options
 * @param {number} options.width
 * @param {number} [options.height]
 * @param {string} [options.unit="px"]
 * @returns {string}
 */
function box(options) {
  return options.width + "x" + (options.height ?? options.width) + (options.unit ?? "px");
}

/**
 * @param {{ width: number, height?: number }} options
 * @returns {number}
 */
function area({ width, height = width }) {
  return width * height;
}

/**
 * @param {object[]} rows
 * @param {number} rows[].id
 * @param {string} [rows[].name]
 * @returns {string}
 */
function names(rows) {
  return rows.map(row => row.id + ":" + (row.name ?? "?")).join();
}

/**
 * @param {?number} n
 * @param {!string} s
 * @param {*} anything
 * @param {?} unknownKind
 * @returns {string}
 */
function oldStyle(n, s, anything, unknownKind) {
  return (n === null ? "null" : n + 1) + s + typeof anything + typeof unknownKind;
}

/**
 * @param {function(number, string): boolean} test
 * @param {Array.<number>} list
 * @param {Object.<string, number>} table
 * @returns {number}
 */
function closureStyle(test, list, table) {
  let count = 0;
  for (const n of list) if (test(n, "k" + n)) count += table["k" + n] ?? 0;
  return count;
}

function usesArguments() {
  return arguments.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += bracketed(i) + bracketed(i, 1) + withEquals(i) + withDefaultInTheComment(i) + withDefaultInTheCode(i) + summed(i) + summed(i, 1, 2) + area({ width: i });
console.log("2000 rounds: " + warm);
console.log(bracketed(1), bracketed(1, 2), bracketed(1, undefined), withEquals(1), withEquals(1, 2), withDefaultInTheComment(1), withDefaultInTheComment(1, 2), withDefaultInTheCode(1), withDefaultInTheCode(1, undefined), withDefaultInTheCode(1, 2));
console.log(summed(1), summed(1, 2), summed(1, 2, 3, 4), box({ width: 1 }), box({ width: 1, height: 2, unit: "em" }), area({ width: 2 }), area({ width: 2, height: 3 }));
console.log(names([{ id: 1 }, { id: 2, name: "two" }]), oldStyle(null, "s", 1, "u"), oldStyle(1, "s", undefined, null), closureStyle((n, k) => n > 1 && k.length === 2, [1, 2, 3], { k2: 20, k3: 30 }));
console.log(usesArguments(), usesArguments(1, 2, 3), bracketed.length, withDefaultInTheCode.length, summed.length);

export {};
