// ───────────── tokens and comments ─────────────
//
// ESLint's `TokenStore`. Where the tokens and the comments are is in arrays of numbers: see
// `tokens.rs`. A search goes through these, and an object is made of a token when a rule gets it.

const tokenTypes = [
  "Boolean",
  "Identifier",
  "JSXIdentifier",
  "JSXText",
  "Keyword",
  "Null",
  "Numeric",
  "PrivateIdentifier",
  "Punctuator",
  "RegularExpression",
  "String",
  "Template",
  "Line",
  "Block",
  "Shebang",
];

class Token {
  constructor(type, value, start, end) {
    this.type = type;
    this.value = value;
    this.start = start;
    this.end = end;
    this.range = [start, end];
  }
}
Object.defineProperty(Token.prototype, "loc", Object.getOwnPropertyDescriptor(Node.prototype, "loc"));

// `{ count, starts, ends, kinds, objects }` for the tokens and for the comments. `null`: not asked for yet.
let tokenList = null;
let commentList = null;

function resetTokens() {
  tokenList = commentList = null;
}

// Takes a list out of `buffer` at the byte `at`.
function readTokenList(buffer, at) {
  const count = new Uint32Array(buffer, at, 1)[0];
  // The next message of the kind overwrites the buffer, and that can be for the next file only.
  return {
    count,
    starts: new Uint32Array(buffer, at + 4, count),
    ends: new Uint32Array(buffer, at + 4 + 4 * count, count),
    kinds: new Uint8Array(buffer, at + 4 + 8 * count, count),
    objects: new Array(count),
    byteLength: 4 + 8 * count + ((count + 3) & ~3),
  };
}

function loadTokens() {
  ask(NEEDS_TOKENS, "", TOKENS);
  tokenList = readTokenList(buffers[TOKENS], 0);
  commentList ??= readTokenList(buffers[TOKENS], tokenList.byteLength);
  return tokenList;
}

function loadComments() {
  ask(NEEDS_COMMENTS, "", COMMENTS);
  return (commentList = readTokenList(buffers[COMMENTS], 0));
}

// espree has the name that an identifier with escape sequences stands for.
function decodeName(name) {
  return name.replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/gu, (_, long, short) =>
    String.fromCodePoint(parseInt(long ?? short, 16)),
  );
}

function makeToken(list, index) {
  const start = list.starts[index];
  const end = list.ends[index];
  const kind = list.kinds[index];
  let value;
  switch (kind) {
    case 7:
      value = text.slice(start + 1, end);
      break;
    case 12:
      // `<!--` and `-->` are comments too.
      value = text.slice(start + (text.charCodeAt(start) === 60 ? 4 : text.charCodeAt(start) === 45 ? 3 : 2), end);
      break;
    case 13:
      value = text.slice(start + 2, end - 2);
      break;
    case 14:
      value = text.slice(start + 2, end);
      break;
    default:
      value = text.slice(start, end);
  }
  if ((kind === 1 || kind === 4 || kind === 7) && value.includes("\\") && dialect() === 1) value = decodeName(value);
  const token = new Token(tokenTypes[kind], value, start, end);
  if (kind === 9) {
    const slash = value.lastIndexOf("/");
    token.regex = { pattern: value.slice(1, slash), flags: value.slice(slash + 1) };
  }
  return (list.objects[index] = token);
}

function tokenAt(list, index) {
  return list.objects[index] ?? makeToken(list, index);
}

function allOf(list, from = 0, to = list.count) {
  const all = [];
  for (let i = from; i < to; i++) all.push(tokenAt(list, i));
  return all;
}

// `ast.tokens`
function tokens() {
  const list = tokenList ?? loadTokens();
  return (list.all ??= allOf(list));
}

// `ast.comments`
function comments() {
  const list = commentList ?? loadComments();
  return (list.all ??= allOf(list));
}

// ESLint's `sourceCode.tokensAndComments`
function tokensAndComments() {
  const list = tokenList ?? loadTokens();
  return (list.withComments ??= someTokens(true, -1, -1, { includeComments: true }));
}

// The index of the first of the sorted `numbers` that is not less than `number`.
function lowerBound(numbers, number) {
  let low = 0;
  let high = numbers.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (numbers[middle] < number) low = middle + 1;
    else high = middle;
  }
  return low;
}

// The index of the first token that starts at `location` or later. -1 is the start of the file.
function firstIndex(list, location) {
  return location === -1 ? 0 : lowerBound(list.starts, location);
}

// The index of the last token that ends at `location` or before. -1 is the end of the file.
function lastIndex(list, location) {
  return location === -1 ? list.count - 1 : lowerBound(list.ends, location + 1) - 1;
}

// A function that returns the next token from `start` to `end`, or from `end` back to `start`, and then `null`.
function cursor(isForward, start, end, includeComments) {
  const list = tokenList ?? loadTokens();
  if (!includeComments) {
    let index = isForward ? firstIndex(list, start) : lastIndex(list, end);
    const last = isForward ? lastIndex(list, end) : firstIndex(list, start);
    if (isForward) return () => (index <= last ? tokenAt(list, index++) : null);
    return () => (index >= last ? tokenAt(list, index--) : null);
  }
  const others = commentList;
  if (isForward) {
    let index = firstIndex(list, start);
    let other = firstIndex(others, start);
    return () => {
      const isToken = index < list.count && (other >= others.count || list.starts[index] < others.starts[other]);
      if (!isToken && other >= others.count) return null;
      const from = isToken ? list : others;
      const at = isToken ? index++ : other++;
      return end === -1 || from.ends[at] <= end ? tokenAt(from, at) : null;
    };
  }
  let index = lastIndex(list, end);
  let other = (end === -1 ? others.count : lowerBound(others.starts, end)) - 1;
  return () => {
    const isToken = index >= 0 && (other < 0 || list.ends[index] > others.ends[other]);
    if (!isToken && other < 0) return null;
    const from = isToken ? list : others;
    const at = isToken ? index-- : other--;
    return start === -1 || from.starts[at] >= start ? tokenAt(from, at) : null;
  };
}

function checkFilter(filter) {
  assert(!filter || typeof filter === "function", "options.filter should be a function.");
}

// ESLint's `createCursorWithSkip(..).getOneToken()`.
function oneToken(isForward, start, end, options) {
  let includeComments = false;
  let skip = 0;
  let filter = null;
  if (typeof options === "number") skip = options | 0;
  else if (typeof options === "function") filter = options;
  else if (options) {
    includeComments = !!options.includeComments;
    skip = options.skip | 0;
    filter = options.filter || null;
  }
  assert(skip >= 0, "options.skip should be zero or a positive integer.");
  checkFilter(filter);
  const next = cursor(isForward, start, end, includeComments);
  for (let token = next(); token !== null; token = next()) {
    if (filter !== null && !filter(token)) continue;
    if (skip-- === 0) return token;
  }
  return null;
}

// ESLint's `createCursorWithCount(..).getAllTokens()`.
function someTokens(isForward, start, end, options) {
  let includeComments = false;
  let count = -1;
  let filter = null;
  if (typeof options === "number") count = options | 0;
  else if (typeof options === "function") filter = options;
  else if (options) {
    includeComments = !!options.includeComments;
    if (typeof options.count === "number") count = options.count | 0;
    filter = options.filter || null;
    assert((options.count | 0) >= 0, "options.count should be zero or a positive integer.");
  }
  assert(count >= -1, "options.count should be zero or a positive integer.");
  checkFilter(filter);
  const found = [];
  if (count === 0) return found;
  const next = cursor(isForward, start, end, includeComments);
  for (let token = next(); token !== null; token = next()) {
    if (filter !== null && !filter(token)) continue;
    found.push(token);
    if (found.length === count) break;
  }
  return isForward ? found : found.reverse();
}

// ESLint's `createCursorWithPadding(..).getAllTokens()`.
function paddedTokens(start, end, before, after) {
  if (typeof before !== "number" && before !== undefined) return someTokens(true, start, end, before);
  const list = tokenList ?? loadTokens();
  const from = Math.max(0, firstIndex(list, start) - (before | 0));
  const to = Math.min(list.count - 1, lastIndex(list, end) + (after | 0));
  return allOf(list, from, to + 1);
}

const isComment = token => token.type === "Line" || token.type === "Block" || token.type === "Shebang";

function adjacentComments(next) {
  const found = [];
  for (let token = next(); token !== null && isComment(token); token = next()) found.push(token);
  return found;
}

class TokenStore {
  getTokenByRangeStart(offset, options) {
    const token = cursor(true, offset, -1, Boolean(options && options.includeComments))();
    return token !== null && token.range[0] === offset ? token : null;
  }
  getFirstToken(node, options) {
    return oneToken(true, node.range[0], node.range[1], options);
  }
  getLastToken(node, options) {
    return oneToken(false, node.range[0], node.range[1], options);
  }
  getTokenBefore(node, options) {
    return oneToken(false, -1, node.range[0], options);
  }
  getTokenAfter(node, options) {
    return oneToken(true, node.range[1], -1, options);
  }
  getFirstTokenBetween(left, right, options) {
    return oneToken(true, left.range[1], right.range[0], options);
  }
  getLastTokenBetween(left, right, options) {
    return oneToken(false, left.range[1], right.range[0], options);
  }
  getFirstTokens(node, options) {
    return someTokens(true, node.range[0], node.range[1], options);
  }
  getLastTokens(node, options) {
    return someTokens(false, node.range[0], node.range[1], options);
  }
  getTokensBefore(node, options) {
    return someTokens(false, -1, node.range[0], options);
  }
  getTokensAfter(node, options) {
    return someTokens(true, node.range[1], -1, options);
  }
  getFirstTokensBetween(left, right, options) {
    return someTokens(true, left.range[1], right.range[0], options);
  }
  getLastTokensBetween(left, right, options) {
    return someTokens(false, left.range[1], right.range[0], options);
  }
  getTokens(node, beforeCount, afterCount) {
    return paddedTokens(node.range[0], node.range[1], beforeCount, afterCount);
  }
  getTokensBetween(left, right, padding) {
    return paddedTokens(left.range[1], right.range[0], padding, padding);
  }
  commentsExistBetween(left, right) {
    const list = commentList ?? loadComments();
    const index = lowerBound(list.starts, left.range[1]);
    return index < list.count && list.ends[index] <= right.range[0];
  }
  getCommentsBefore(nodeOrToken) {
    return adjacentComments(cursor(false, -1, nodeOrToken.range[0], true)).reverse();
  }
  getCommentsAfter(nodeOrToken) {
    return adjacentComments(cursor(true, nodeOrToken.range[1], -1, true));
  }
  getCommentsInside(node) {
    return someTokens(true, node.range[0], node.range[1], { includeComments: true, filter: isComment });
  }
  // Until ESLint 8.
  getTokenOrCommentBefore(node, skip) {
    return this.getTokenBefore(node, { includeComments: true, skip });
  }
  getTokenOrCommentAfter(node, skip) {
    return this.getTokenAfter(node, { includeComments: true, skip });
  }
  isSpaceBetween(first, second) {
    const overlaps =
      (first.range[0] <= second.range[0] && first.range[1] >= second.range[0]) ||
      (second.range[0] <= first.range[0] && second.range[1] >= first.range[0]);
    if (overlaps) return false;
    const [starting, ending] = first.range[1] <= second.range[0] ? [first, second] : [second, first];
    const final = this.getFirstToken(ending) || ending;
    let current = this.getLastToken(starting) || starting;
    while (current !== final) {
      const next = this.getTokenAfter(current, { includeComments: true });
      if (current.range[1] !== next.range[0]) return true;
      current = next;
    }
    return false;
  }
  isSpaceBetweenTokens(first, second) {
    return this.isSpaceBetween(first, second);
  }
}
