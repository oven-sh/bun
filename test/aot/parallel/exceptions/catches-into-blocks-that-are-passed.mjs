// A branch whose two ways do nothing becomes a jump, which is led past the empty block behind it. A catch that only a
// later sweep reaches may lead into that block too.
const show = value => typeof value === "object" ? Object.values(value).join() : String(value);

function chosen(text, number, flag, other) {
  let sum = 0, list = [13].slice(0, 4), held = {}, joined = "" + number, value;
  if (flag) value = text;
  if (show(held) === "6") {
    const length = () => list.length;
    sum = length();
  }
  try {
    held = value.length;
  } catch {
    try {
      held = {};
      if ("bc" < "text") throw number === other ? joined : value;
    } catch {
      for (let i = 0; i < 3; i++) list = list;
    }
  }
  console.log(sum);
}

function kept(first, text, limit, flag, odd, other, number, swapped) {
  let sum = 0, half = (number * 0.5) | 0, list = [13].slice(0, 4), joined = ("" + number).slice(0, 8), held = {}, last = half, sent = half << 0, record = {}, value, point = swapped ? { x: 3, y: 7.5 } : record, back = flag;
  if (flag) {
    for (let i = 0; i < 4; i++) {
      if (last <= limit) {
        last = point.x | 0;
        value = text.slice(0, 2);
      }
    }
  }
  if (show(held) === show({ x: 6, y: 0.5 })) {
    const length = q => list.length;
    sum = length(first << 0);
    swapped = back;
  }
  try {
    sent = value.length;
  } catch {
    try {
      record = {};
      if ("bc" < "text") throw other === last ? joined : value;
    } catch {
      for (let i = 0; i < 3; i++) list = list;
    }
  }
  console.log(show(sum));
}

try { chosen(JSON.parse('""'), JSON.parse("2"), JSON.parse("false"), JSON.parse("true")); } catch {}
try { kept(65536, JSON.parse('""'), JSON.parse("2147483647"), JSON.parse("false"), 1.25, 65536, 1, JSON.parse("true")); } catch {}
