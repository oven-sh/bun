// A literal of forty awaited calls. One call rejects in the middle: the calls behind it never run, nobody sees the list, and the next literal is a list of its own.
let calls = 0;
async function item(failAt: number) {
  calls++;
  if (calls === failAt) throw new Error("item " + calls);
  return { at: calls };
}

async function list(f: number) {
  return [
    await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f),
    await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f),
    await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f),
    await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f), await item(f),
  ];
}

const whole = await list(0);
console.log(whole.length, whole[0].at, whole[39].at, whole.map(e => e.at).join(""), Array.isArray(whole), Object.keys(whole).length);
try { await list(calls + 17); } catch (e) { console.log((e as Error).message, calls); }
try { await list(calls + 1); } catch (e) { console.log((e as Error).message, calls); }
try { await list(calls + 40); } catch (e) { console.log((e as Error).message, calls); }
const [one, other] = await Promise.all([list(0), list(0)]);
console.log(one === other, one.length, other.length, one.map(e => e.at % 10).join(""), other.map(e => e.at % 10).join(""));
one.push({ at: -1 });
one[0] = { at: -2 };
console.log(one.length, one[0].at, one[40].at, other.length, other[0].at > 0);
