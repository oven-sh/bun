// ───────────── ESLint's `context.report()` ─────────────

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIsString(text) {
  if (typeof text !== "string") throw new TypeError("'text' must be a string");
}

// ESLint's `RuleFixer`.
const fixer = Object.freeze({
  insertTextAfter(nodeOrToken, text) {
    return this.insertTextAfterRange(nodeOrToken.range, text);
  },
  insertTextAfterRange(range, text) {
    assertIsString(text);
    return { range: [range[1], range[1]], text };
  },
  insertTextBefore(nodeOrToken, text) {
    return this.insertTextBeforeRange(nodeOrToken.range, text);
  },
  insertTextBeforeRange(range, text) {
    assertIsString(text);
    return { range: [range[0], range[0]], text };
  },
  replaceText(nodeOrToken, text) {
    return this.replaceTextRange(nodeOrToken.range, text);
  },
  replaceTextRange(range, text) {
    assertIsString(text);
    return { range, text };
  },
  remove(nodeOrToken) {
    return this.removeRange(nodeOrToken.range);
  },
  removeRange(range) {
    return { range, text: "" };
  },
});

function interpolate(message, data) {
  if (!data || !message.includes("{{")) return message;
  return message.replace(/\{\{([^{}]+)\}\}/gu, (whole, name) => {
    const term = name.trim();
    return term in data ? data[term] : whole;
  });
}

function assertValidFix(fix) {
  if (fix && !(fix.range && typeof fix.range[0] === "number" && typeof fix.range[1] === "number")) {
    assert(false, `Fix has invalid range: ${JSON.stringify(fix, null, 2)}`);
  }
}

// `[start, end, text]`
function mergeFixes(fixes) {
  fixes.forEach(assertValidFix);
  if (fixes.length === 0) return null;
  if (fixes.length === 1) return [fixes[0].range[0], fixes[0].range[1], fixes[0].text];
  fixes.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
  const start = fixes[0].range[0];
  const end = fixes.at(-1).range[1];
  let merged = "";
  let last = Number.MIN_SAFE_INTEGER;
  for (const fix of fixes) {
    assert(fix.range[0] >= last, "Fix objects must not be overlapped in a report.");
    if (fix.range[0] >= 0) merged += text.slice(Math.max(0, start, last), fix.range[0]);
    merged += fix.text;
    last = fix.range[1];
  }
  merged += text.slice(Math.max(0, start, last), end);
  return [start, end, merged];
}

function normalizeFixes(descriptor) {
  if (typeof descriptor.fix !== "function") return null;
  const fix = descriptor.fix(fixer);
  if (fix && Symbol.iterator in fix) return mergeFixes(Array.from(fix));
  assertValidFix(fix);
  return fix ? [fix.range[0], fix.range[1], fix.text] : null;
}

function validateSuggestions(suggest, messages) {
  if (!suggest || !Array.isArray(suggest)) return;
  for (const suggestion of suggest) {
    if (suggestion.messageId) {
      const { messageId } = suggestion;
      if (!messages) {
        throw new TypeError(
          `context.report() called with a suggest option with a messageId '${messageId}', but no messages were present in the rule metadata.`,
        );
      }
      if (!messages[messageId]) {
        throw new TypeError(
          `context.report() called with a suggest option with a messageId '${messageId}' which is not present in the 'messages' config: ${JSON.stringify(messages, null, 2)}`,
        );
      }
      if (suggestion.desc) {
        throw new TypeError(
          "context.report() called with a suggest option that defines both a 'messageId' and an 'desc'. Please only pass one.",
        );
      }
    } else if (!suggestion.desc) {
      throw new TypeError(
        "context.report() called with a suggest option that doesn't have either a `desc` or `messageId`",
      );
    }
    if (typeof suggestion.fix !== "function") {
      throw new TypeError(
        `context.report() called with a suggest option without a fix function. See: ${JSON.stringify(suggestion, null, 2)}`,
      );
    }
  }
}

function messageOf(descriptor, messages) {
  if (descriptor.messageId) {
    if (!messages) {
      throw new TypeError(
        "context.report() called with a messageId, but no messages were present in the rule metadata.",
      );
    }
    const id = descriptor.messageId;
    if (descriptor.message) {
      throw new TypeError("context.report() called with a message and a messageId. Please only pass one.");
    }
    if (!Object.hasOwn(messages, id)) {
      throw new TypeError(
        `context.report() called with a messageId of '${id}' which is not present in the 'messages' config: ${JSON.stringify(messages, null, 2)}`,
      );
    }
    return messages[id];
  }
  if (descriptor.message) return descriptor.message;
  throw new TypeError(
    "Missing `message` property in report() call; add a message that describes the linting problem.",
  );
}

// What is reported about the file:
// `[rule, message, messageId, line, column, endLine, endColumn, fix, suggestions]`.
let reports = [];
let wantsFixes = true;

// `position`: the index of the rule among those that run on the file.
function report(position, meta, args) {
  let descriptor = args[0];
  if (args.length > 1) {
    descriptor =
      typeof args[1] === "string"
        ? { node: args[0], message: args[1], data: args[2], fix: args[3] }
        : { node: args[0], loc: args[1], message: args[2], data: args[3], fix: args[4] };
  }
  const messages = meta?.messages;
  if (descriptor.node) assert(typeof descriptor.node === "object", "Node must be an object");
  else assert(descriptor.loc, "Node must be provided when reporting error if location is not provided");
  const message = messageOf(descriptor, messages);
  validateSuggestions(descriptor.suggest, messages);
  const loc = descriptor.loc ?? descriptor.node.loc;
  const start = loc.start ?? loc;
  const end = loc.start ? loc.end : null;
  const fix = wantsFixes ? normalizeFixes(descriptor) : null;
  let suggestions = null;
  if (wantsFixes && Array.isArray(descriptor.suggest)) {
    suggestions = [];
    for (const suggestion of descriptor.suggest) {
      const desc = interpolate(suggestion.desc || messages[suggestion.messageId], suggestion.data);
      const fix = normalizeFixes(suggestion);
      if (fix) suggestions.push([suggestion.messageId ?? null, desc, dataOf(suggestion.data), fix]);
    }
    if (suggestions.length === 0) suggestions = null;
  }
  reports.push([
    position,
    String(interpolate(message, descriptor.data)),
    descriptor.messageId ?? null,
    start.line,
    start.column + 1,
    end ? end.line : null,
    end ? end.column + 1 : null,
    fix,
    suggestions,
  ]);
  if (fix && !meta?.fixable) {
    throw new Error('Fixable rules must set the `meta.fixable` property to "code" or "whitespace".');
  }
  if (suggestions && meta?.hasSuggestions !== true) {
    if (meta?.docs && typeof meta.docs.suggestion !== "undefined") {
      throw new Error(
        "Rules with suggestions must set the `meta.hasSuggestions` property to `true`. `meta.docs.suggestion` is ignored by ESLint.",
      );
    }
    throw new Error("Rules with suggestions must set the `meta.hasSuggestions` property to `true`.");
  }
}

// The `data` of a suggestion, which ESLint passes on.
function dataOf(data) {
  if (!data) return null;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]));
}
