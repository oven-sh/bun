interface Parcel {
  weight: number;
}

const log: string[] = [];

function touch(parcel: Parcel): number {
  return parcel.weight;
}

function touchTwice(parcel: Parcel): void {
  parcel.weight;
  parcel.weight;
}

class Scale {
  read(parcel: Parcel): number {
    return parcel.weight;
  }
}

function attempt(label: string, run: () => void) {
  try {
    run();
    console.log(label, "returned", log.join());
  } catch (error) {
    console.log(label, "threw", (error as Error).constructor.name, log.join());
  }
  log.length = 0;
}

const honest: Parcel = { weight: 1 };
for (let i = 0; i < 2000; i++) touch(honest);

const counting: any = {
  get weight() {
    log.push("getter");
    return 2;
  },
};
const throwing: any = {
  get weight() {
    log.push("getter");
    throw new RangeError("no weight");
  },
};
const trapped: any = new Proxy({}, {
  get(target, key) {
    log.push("get " + String(key));
    return 3;
  },
});
const inherited: any = Object.create(counting);
const nothing: any = undefined;
const empty: any = null;
const text: any = "text";

const scale = new Scale();
for (const [name, value] of [["counting", counting], ["throwing", throwing], ["trapped", trapped], ["inherited", inherited], ["undefined", nothing], ["null", empty], ["text", text], ["honest", honest]] as [string, any][]) {
  attempt("touch " + name, () => {
    touch(value);
  });
  attempt("touch twice " + name, () => {
    touchTwice(value);
  });
  attempt("method " + name, () => {
    scale.read(value);
  });
  attempt("through call " + name, () => {
    touch.call(undefined, value);
  });
}
