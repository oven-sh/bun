let sum = 0;
class Refused extends Error { constructor(message, code) { super(message); this.code = code; this.name = "Refused"; } }
function deep(n) { if (n === 0) throw new Refused("no", 7); return deep(n - 1) + 1; }
for (let i = 0; i < 12000; i++) {
  try { deep(i % 20); } catch (error) { sum += error.code + (error.stack.length > 0 ? 1 : 0) + (error instanceof Refused ? 1 : 0); }
  try { null.x; } catch (error) { sum += error.message.length; }
  try { undefinedName; } catch (error) { sum += error.name.length; }
  const holder = {}; Error.captureStackTrace(holder); sum += (holder.stack.length > 0 ? 1 : 0);
  sum += new Error("cause", { cause: holder }).cause === holder ? 1 : 0;
  try { try { throw i; } finally { sum++; } } catch (thrown) { sum += thrown; }
}
console.log(sum);
