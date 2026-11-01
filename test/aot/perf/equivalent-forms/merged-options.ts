// Loops that add up three members of objects put together from defaults and options of one interface. ../equivalent-forms.test.ts says which pairs should cost about the same.
// Each way has a type of its own, so that no way is read through what another way proves.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

interface Settings {
  retries: number;
  delay: number;
  limit: number;
}
const defaults: Settings = { retries: 1, delay: 2, limit: 3 };
const given: Partial<Settings>[] = [{ delay: 5 }, { limit: 6 }];

interface Wishes {
  tries?: number;
  pause?: number;
  most?: number;
}
const settled: Required<Wishes> = { tries: 1, pause: 2, most: 3 };
const wished: Wishes[] = [{ pause: 5 }, { most: 6 }];

const written: (Settings & { written: number })[] = [];
const spelled: (Settings & { spelled: number })[] = [];
const spread: (Settings & { spread: number })[] = [];
const assigned: (Settings & { assigned: number })[] = [];
const spreadUnderTheInterface: Settings[] = [];
const assignedUnderTheInterface: Settings[] = [];
const spreadUnderWhatRequiredMakes: Required<Wishes>[] = [];
for (let k = 0; k < 8; k++) {
  const options = given[k & 1];
  written.push({ written: k, retries: 1, delay: k & 1 ? 2 : 5, limit: k & 1 ? 6 : 3 });
  spelled.push({
    spelled: k,
    retries: defaults.retries,
    delay: options.delay ?? defaults.delay,
    limit: options.limit ?? defaults.limit,
  });
  spread.push({ spread: k, ...defaults, ...options });
  assigned.push(Object.assign({ assigned: k }, defaults, options));
  spreadUnderTheInterface.push({ ...defaults, ...options });
  assignedUnderTheInterface.push(Object.assign({}, defaults, options));
  spreadUnderWhatRequiredMakes.push({ ...settled, ...wished[k & 1] });
}

const loops: Record<string, (n: number) => number> = {
  "members that a literal gives numbers written in place": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = written[i & 7];
      sum += object.retries + object.delay + object.limit;
    }
    return sum;
  },
  "members that a literal spells out": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = spelled[i & 7];
      sum += object.retries + object.delay + object.limit;
    }
    return sum;
  },
  "members that two spreads bring behind a member of the literal": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = spread[i & 7];
      sum += object.retries + object.delay + object.limit;
    }
    return sum;
  },
  "members that Object.assign brings to a literal with a member": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = assigned[i & 7];
      sum += object.retries + object.delay + object.limit;
    }
    return sum;
  },
  "members that two spreads bring under the interface of the defaults": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = spreadUnderTheInterface[i & 7];
      sum += object.retries + object.delay + object.limit;
    }
    return sum;
  },
  "members that Object.assign brings to an empty literal under the interface of the defaults": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = assignedUnderTheInterface[i & 7];
      sum += object.retries + object.delay + object.limit;
    }
    return sum;
  },
  "members that two spreads bring under what Required makes of the options": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = spreadUnderWhatRequiredMakes[i & 7];
      sum += object.tries + object.pause + object.most;
    }
    return sum;
  },
};

if (which) console.log(which, loops[which](rounds));
else {
  for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
  console.log(JSON.stringify([written[0], written[1], spelled[0], spelled[1], spread[0], spread[1], assigned[0], assigned[1], spreadUnderTheInterface[0], assignedUnderTheInterface[1], spreadUnderWhatRequiredMakes[1]]));
}

export {};
