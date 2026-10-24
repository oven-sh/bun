type Describe = (x: number) => string;

function early(x: number): string {
  return "early " + x;
}

function late(x: number): string {
  return "late " + x;
}

class Holder {
  describe: Describe = early;
}

const put = (holder: Holder, describe: Describe) => {
  holder.describe = describe;
};

const holder = new Holder();
console.log(holder.describe(1));
put.call(undefined, holder, late);
console.log(holder.describe(2));
