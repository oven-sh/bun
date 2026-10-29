// Static fields under an experimental decorator, with a value and without one, beside fields without a decorator: the keys of the class in every listing, after each store, in classes at the top level and in classes that a function makes twice.
function seen(_target: unknown, _key: string) {}
function listed(label: string, holder: object) {
  const walked: string[] = [];
  for (const key in holder) walked.push(key);
  console.log(
    label,
    Reflect.ownKeys(holder).join(),
    walked.join(),
    Object.keys(holder).join(),
    Object.entries(holder).join(";"),
    JSON.stringify({ ...holder }),
    JSON.stringify(Object.assign({}, holder)),
  );
}

class StoredInABlock {
  @seen static m: number;
  static s = 1;
  static {
    this.m = 2;
  }
  static t = 3;
}
listed("stored in a block", StoredInABlock);

class WithAValue {
  @seen static m = 2;
  static s = 1;
  @seen static n = 4;
  static t = 3;
}
listed("with a value", WithAValue);

class StoredFromOutside {
  @seen static m: number;
  static s = 1;
  static t = 3;
}
listed("ahead of the store from outside", StoredFromOutside);
StoredFromOutside.m = 5;
listed("behind the store from outside", StoredFromOutside);

function make(turn: number) {
  class StoredInABlock {
    @seen static m: number;
    static s = 1;
    static {
      this.m = turn;
    }
    static t = 3;
  }
  listed("stored in a block, made by a function", StoredInABlock);

  class WithAValue {
    @seen static m = turn;
    static s = 1;
    @seen static n = 4;
    static t = 3;
  }
  listed("with a value, made by a function", WithAValue);

  class StoredFromOutside {
    @seen static m: number;
    static s = 1;
    static t = 3;
  }
  listed("ahead of the store from outside, made by a function", StoredFromOutside);
  StoredFromOutside.m = turn;
  listed("behind the store from outside, made by a function", StoredFromOutside);
  console.log(StoredInABlock.m, WithAValue.m, WithAValue.n, StoredFromOutside.m, "m" in StoredFromOutside);

  class NeverStored {
    @seen static m: number;
    static s = 1;
  }
  listed("never stored, made by a function", NeverStored);
  console.log(NeverStored.m, "m" in NeverStored, Object.hasOwn(NeverStored, "m"));
}
make(1);
make(2);
for (let turn = 0; turn < 2; turn++) {
  class InALoop {
    @seen static m: number;
    static s = 1;
    static {
      this.m = turn;
    }
  }
  listed("in a loop", InALoop);
}
