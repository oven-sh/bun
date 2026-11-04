// A regular expression literal that is nested deeper than the build analyzes is made where it is evaluated, and is what any other literal is.
// Ten parentheses stand in front of each letter.
function create() {
  return /((((((((((a?((((((((((b?((((((((((c?((((((((((d?((((((((((e?((((((((((f?((((((((((g?((((((((((h?((((((((((i?((((((((((j?((((((((((k?((((((((((l?((((((((((m?((((((((((n?((((((((((o?((((((((((p?((((((((((q?((((((((((r?((((((((((s?((((((((((t?((((((((((u?((((((((((v?((((((((((w?((((((((((x?((((((((((y?((((((((((z?!))))))))))a?))))))))))b?))))))))))c?))))))))))d?))))))))))e?))))))))))f?))))))))))g?))))))))))h?))))))))))i?))))))))))j?))))))))))k?))))))))))l?))))))))))m?))))))))))n?))))))))))o?))))))))))p?))))))))))q?))))))))))r?))))))))))s?))))))))))t?))))))))))u?))))))))))v?))))))))))w?))))))))))x?))))))))))y?))))))))))z?/g;
}

const first = create();
const second = create();
const depth = first.source.split("(").length - 1;
// Limits::regExpParenthesesDepth of the engine.
if (depth <= 256) throw new Error(`the build analyzes a literal that is nested ${depth} deep`);

console.log(Object.getPrototypeOf(first) === RegExp.prototype, first !== second, first.flags, first.source.length);

const match = first.exec("-a!z!");
console.log(match?.index, match?.length, match?.[0], match?.[1], match?.[depth], first.lastIndex, second.lastIndex);
console.log("a!z!".replace(create(), "-"), "none".search(create()), create().test("!"));

function inHandler() {
  try {
    return create().source === first.source;
  } catch (error) {
    return String(error);
  }
}
console.log(inHandler());
