// Prototype of no-self-assign on a tree of Bun's shape plus the source text.
"use strict";
const T = require("./tok.cjs");

const ASSIGN_OPS = new Set(["BinAssign", "BinLogicalAndAssign", "BinLogicalOrAssign", "BinNullishCoalescingAssign"]);
const isMember = e => e.kind === "EDot" || e.kind === "EIndex";

// ---- names -------------------------------------------------------------------------------------

function bigintDecimal(text) {
	// text: digits, maybe with a 0x / 0o / 0b prefix, no separators, no suffix.
	return BigInt(text).toString();
}

function regexName(raw) {
	const slash = raw.lastIndexOf("/");
	const flags = raw.slice(slash + 1);
	const order = "dgimsuvy";
	const sorted = [...flags].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("");
	return raw.slice(0, slash + 1) + sorted;
}

// getStaticStringValue: the string that a literal is as a property name, or null.
function staticString(e) {
	switch (e.kind) {
		case "EString":
			return e.value;
		case "ENumber":
			return String(e.value);
		case "EBigInt":
			return bigintDecimal(e.value);
		case "ERegExp":
			return regexName(e.value);
		case "ENull":
			return "null";
		case "EBoolean":
			return e.value ? "true" : "false";
		default:
			return null;
	}
}

// getStaticPropertyName of a member expression.
function memberName(e) {
	if (e.kind === "EDot") return e.name;
	if (e.index.kind === "EPrivateIdentifier") return null;
	return staticString(e.index);
}

// getStaticPropertyName of a property of an object literal or pattern.
function propertyName(p) {
	if (p.key === null) return null;
	if (!p.flags.IsComputed) {
		return p.key.kind === "EString" || p.key.kind === "ENumber" || p.key.kind === "EBigInt" ? staticString(p.key) : null;
	}
	return staticString(p.key);
}

// ---- isSameReference ---------------------------------------------------------------------------

function sameLiteral(l, r) {
	// equalLiteralValue, for two nodes that ESTree calls Literal.
	if (l.kind === "ERegExp" || r.kind === "ERegExp") return l.kind === r.kind && l.value === r.value;
	if (l.kind === "EBigInt" || r.kind === "EBigInt")
		return l.kind === r.kind && bigintDecimal(l.value) === bigintDecimal(r.value);
	if (l.kind !== r.kind) return false;
	if (l.kind === "ENull") return true;
	return l.value === r.value;
}

const isLiteral = e =>
	(e.kind === "EString" && !e.prefer_template) ||
	e.kind === "ENumber" || e.kind === "EBigInt" || e.kind === "ERegExp" || e.kind === "ENull" || e.kind === "EBoolean";

function sameReference(l, r) {
	// Loops along the two target chains: only an index expression recurses.
	for (;;) {
		if (isMember(l) && isMember(r)) {
			const nameL = memberName(l);
			if (nameL !== null) {
				if (nameL !== memberName(r)) return false;
			} else {
				const computedL = l.kind === "EIndex" && l.index.kind !== "EPrivateIdentifier";
				const computedR = r.kind === "EIndex" && r.index.kind !== "EPrivateIdentifier";
				if (computedL !== computedR) return false;
				// nameL is null, so l is an EIndex. r is one too: an EDot is not computed and l is either
				// computed or private, and a private l needs a non computed r that is private to match below.
				if (r.kind !== "EIndex") return false;
				if (!sameReference(l.index, r.index)) return false;
			}
			l = l.target;
			r = r.target;
			continue;
		}
		if (l.kind === "EThis" || l.kind === "ESuper") return l.kind === r.kind;
		if (l.kind === "EIdentifier" || l.kind === "EPrivateIdentifier") return l.kind === r.kind && l.name === r.name;
		if (isLiteral(l) && isLiteral(r)) return sameLiteral(l, r);
		return false;
	}
}

// ---- source ranges -----------------------------------------------------------------------------

// After `from`: white space, comments and close parentheses, then one of `stops`. Returns
// { closes, at } or null. stops is a list of strings.
function closesUntil(src, from, stops) {
	let i = from;
	let closes = 0;
	for (;;) {
		i = T.skipTrivia(src, i);
		if (i < 0 || i >= src.length) return null;
		if (src[i] === 0x29) {
			closes += 1;
			i += 1;
			continue;
		}
		for (const s of stops) {
			if (src.subarray(i, i + s.length).toString("latin1") === s) return { closes, at: i, stop: s };
		}
		return null;
	}
}

function leafEnd(src, e) {
	const at = e.loc;
	const word = w => (src.subarray(at, at + w.length).toString("latin1") === w ? at + w.length : -1);
	switch (e.kind) {
		case "EIdentifier": {
			const end = T.identEnd(src, at);
			return end > at ? end : -1;
		}
		case "EPrivateIdentifier": {
			if (src[at] !== 0x23) return -1;
			const end = T.identEnd(src, at + 1);
			return end > at + 1 ? end : -1;
		}
		case "EThis":
			return word("this");
		case "ESuper":
			return word("super");
		case "ENull":
			return word("null");
		case "EBoolean":
			return word(e.value ? "true" : "false");
		case "ENumber":
		case "EBigInt": {
			const end = T.numberEnd(src, at);
			return end > at ? end : -1;
		}
		case "EString":
			if (src[at] === 0x60) {
				const [end, opens] = T.templateChunkEnd(src, at + 1);
				return opens ? -1 : end;
			}
			return src[at] === 0x27 || src[at] === 0x22 ? T.stringEnd(src, at) : -1;
		case "ERegExp":
			return at + Buffer.byteLength(e.value, "utf8");
		default:
			return -1;
	}
}

// The range that ESTree gives the node: from its first token, with the parentheses that belong to an
// operand inside it, to the end of its last token. null when the text is not as expected.
function rangeOf(src, e) {
	// Down the target chain, then back up.
	const chain = [];
	let cur = e;
	while (isMember(cur)) {
		chain.push(cur);
		cur = cur.target;
	}
	let start = cur.loc;
	let end = leafEnd(src, cur);
	if (end < 0) return null;
	for (let k = chain.length - 1; k >= 0; k--) {
		const m = chain[k];
		// Parentheses around the target close between the target and the `.`, `?.` or `[`.
		const stop = closesUntil(src, end, ["?.", ".", "["]);
		if (stop === null) return null;
		if (stop.closes > 0) {
			start = T.backOver(src, start, stop.closes);
			if (start < 0) return null;
		}
		if (m.kind === "EDot") {
			const nameEnd = T.identEnd(src, m.name_loc);
			if (nameEnd === m.name_loc) return null;
			end = nameEnd;
		} else if (m.index.kind === "EPrivateIdentifier") {
			end = leafEnd(src, m.index);
			if (end < 0) return null;
		} else {
			const inner = rangeOf(src, m.index);
			if (inner === null) return null;
			const close = closesUntil(src, inner.end, ["]"]);
			if (close === null) return null;
			end = close.at + 1;
		}
	}
	return { start, end };
}

function stripSpaces(text) {
	return text.replace(/\s+/gu, "");
}

// ---- the rule ----------------------------------------------------------------------------------

function createRule(src, report) {
	// Assignments that are the default value of a pattern element: ESTree has an AssignmentPattern there.
	const holders = new Set();

	function markPattern(e, depth) {
		if (e === null || depth > 1000) return;
		if (e.kind === "EArray") {
			for (const item of e.items) markElement(item, depth + 1);
		} else if (e.kind === "EObject") {
			for (const p of e.properties) {
				if (p.value === null) continue;
				if (p.pkind === "Spread") markPattern(p.value, depth + 1);
				else markElement(p.value, depth + 1);
			}
		}
	}
	function markElement(e, depth) {
		if (e.kind === "ESpread") markPattern(e.value, depth + 1);
		else if (e.kind === "EBinary" && e.op === "BinAssign") {
			holders.add(e);
			markPattern(e.left, depth + 1);
		} else markPattern(e, depth + 1);
	}

	function reportNode(right) {
		const range = rangeOf(src, right);
		if (range === null) {
			report({ start: right.loc, len: 0, name: null });
			return;
		}
		const text = src.subarray(range.start, range.end).toString("utf8");
		report({ start: range.start, len: range.end - range.start, name: stripSpaces(text) });
	}

	function each(left, right, depth) {
		if (left === null || right === null || depth > 1000) return;
		if (left.kind === "EMissing" || right.kind === "EMissing") return;
		if (left.kind === "EIdentifier" && right.kind === "EIdentifier" && left.name === right.name) {
			reportNode(right);
		} else if (left.kind === "EArray" && right.kind === "EArray") {
			const end = Math.min(left.items.length, right.items.length);
			for (let i = 0; i < end; i++) {
				const l = left.items[i];
				const r = right.items[i];
				if (l.kind === "ESpread" && i < right.items.length - 1) break;
				each(l, r, depth + 1);
				if (r.kind === "ESpread") break;
			}
		} else if (left.kind === "ESpread" && right.kind === "ESpread") {
			each(left.value, right.value, depth + 1);
		} else if (left.kind === "EObject" && right.kind === "EObject" && right.properties.length >= 1) {
			let startJ = 0;
			for (let i = right.properties.length - 1; i >= 0; i--) {
				if (right.properties[i].pkind === "Spread") {
					startJ = i + 1;
					break;
				}
			}
			for (const lp of left.properties) {
				for (let j = startJ; j < right.properties.length; j++) eachProperty(lp, right.properties[j], depth + 1);
			}
		} else if (isMember(left) && isMember(right) && sameReference(left, right)) {
			reportNode(right);
		}
	}

	function eachProperty(lp, rp, depth) {
		if (lp.pkind !== "Normal" || rp.pkind !== "Normal" || rp.flags.IsMethod) return;
		const name = propertyName(lp);
		if (name === null || name !== propertyName(rp)) return;
		if (lp.initializer !== null) return;
		each(lp.value, rp.value, depth);
	}

	return {
		// Every EBinary, before its operands are walked.
		onBinary(e) {
			if (!ASSIGN_OPS.has(e.op)) return;
			if (e.op === "BinAssign" && holders.delete(e)) return;
			if (e.op === "BinAssign") markPattern(e.left, 0);
			each(e.left, e.right, 0);
		},
		// The head of for-in and for-of when it is an expression.
		onForHead(e) {
			markPattern(e, 0);
		},
	};
}

module.exports = { createRule, rangeOf, sameReference, memberName, propertyName };
