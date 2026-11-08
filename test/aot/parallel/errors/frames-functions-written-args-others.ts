// Functions are written as the arguments of array methods. Most receivers are plain arrays; some have a method of their own under the same name, which gives the function object it is handed a displayName or a name and may keep it.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const known = new Set(["check", "big", "step", "displayed", "named", "every", "filter", "some", "map", "strings", "serious", "counted", "largeOnes", "again", "own", "<anonymous>"]);
function namesOf(stack: string, from: number) {
  return stack
    .split("\n")
    .slice(from, from + 3)
    .map(line => line.trim().split(" ")[1])
    .map(name => (known.has(name) ? name : "-"))
    .join(",");
}
const frames = () => namesOf(new Error("x").stack!, 2);
const lines: string[] = [];
const kept: { callback: ((item: unknown) => unknown) | null } = { callback: null };

function withOwnMethod(name: string, list: unknown[], rename: (callback: Function) => void) {
  Object.defineProperty(list, name, {
    value: function own(callback: (item: unknown) => unknown) {
      rename(handedBack(callback));
      kept.callback = callback;
      return callback(list[0]) ? list : [];
    },
  });
  return list;
}
const display = (callback: any) => void (callback.displayName = "displayed");
const define = (callback: Function) => void Object.defineProperty(callback, "name", { value: "named" });

function strings(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.every(function check(item) {
    lines.push(frames());
    return typeof item === "string";
  });
}
function anonymous(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some(item => {
    lines.push(frames());
    return typeof item === "number";
  });
}
type Problem = { severity: string };
function serious(errors: Problem[]) {
  return errors.filter(function check(e) {
    lines.push(frames());
    return e.severity !== "warning";
  });
}
function counted(value: unknown, limit: number, label: string) {
  let count = 0;
  const list = Array.isArray(value) ? value : [];
  const result = list.filter(function check(item) {
    count++;
    if (count === limit) lines.push(label + ":" + frames());
    return item != null;
  });
  return result.length + count;
}
function largeOnes(value: unknown, seed: number) {
  if (!Array.isArray(value)) return 0;
  if (kept.callback && seed === 3) kept.callback(-1);
  let total = seed;
  const chosen = value.filter(function big(item) {
    let sum = total;
    for (let i = 0; i < 3; i++) {
      switch ((sum + i) % 7) {
        case 0: sum += i * 3; break;
        case 1: sum -= i; break;
        case 2: sum ^= 5; break;
        case 3: sum += String(item).length; break;
        case 4: sum = (sum << 1) & 1023; break;
        case 5: sum += typeof item === "string" ? 2 : 1; break;
        default: sum += 7;
      }
      if (sum > 900) sum -= 800;
      else if (sum < -900) sum += 800;
    }
    for (const key of Object.keys({ a: sum, b: item })) sum += key.length;
    total = sum;
    lines.push(frames());
    return sum % 2 === 0 || item === -1;
  });
  return chosen.length;
}
function throwing(value: unknown) {
  if (!Array.isArray(value)) return;
  try {
    value.map(item => {
      if (item === 2) throw new Error("thrown");
      return item;
    });
  } catch (error) {
    lines.push(namesOf((error as Error).stack!, 1));
  }
}
function again(value: unknown[]) {
  const step = function step(item: unknown) {
    if (item === 2) handedBack(step).displayName = "displayed";
    lines.push(frames());
    return true;
  };
  return value.every(step);
}
function show(title: string) {
  console.log(title + " " + lines.join(" | "));
  lines.length = 0;
}

for (let round = 0; round < 3; round++) {
  strings(["a"]);
  strings(withOwnMethod("every", ["a"], display));
  strings(["a", "b"]);
  strings(withOwnMethod("every", ["a"], define));
  strings(["a"]);
  show("every");

  anonymous([1]);
  anonymous(withOwnMethod("some", [1], display));
  anonymous([1]);
  show("some");

  serious([{ severity: "error" }]);
  serious(withOwnMethod("filter", [{ severity: "error" }], display) as Problem[]);
  serious([{ severity: "warning" }]);
  show("filter");

  counted([1, 2, 3], 2, "plain");
  counted(withOwnMethod("filter", [1], display), 1, "own");
  counted([1, 2, 3], 3, "plain");
  show("captures");

  kept.callback = null;
  largeOnes([1], 1);
  largeOnes(withOwnMethod("filter", [1], display), 2);
  largeOnes([1], 3);
  show("large");

  throwing([1, 2]);
  throwing(withOwnMethod("map", [2], display));
  throwing([2]);
  show("thrown");

  again([1, 2, 3]);
  again([1]);
  show("while it runs");
}
