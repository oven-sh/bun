// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// CHECK-LABEL: function {{*}}name="describe"
// CHECK-LABEL: function {{*}}name="tagged"
// CHECK-LABEL: function {{*}}name="Point"
// CHECK-LABEL: function {{*}}name="sum"
// CHECK-LABEL: function {{*}}name="Child"

// FILE: main.ts
// An experimental decorator replaces a class with a subclass.
function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function tagged<T extends new (...args: any[]) => object>(target: T) {
  return class extends target {
    tag = "added by the decorator";
  };
}

@tagged
class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

const made = new Point();
console.log(describe(made));
console.log("members: " + made.x + " " + made.y + " " + made.sum());
console.log("instance: " + (made instanceof Point));
class Child extends Point {
  z = 3;
}
console.log("a subclass of the decorated class: " + describe(new Child()) + " " + new Child().sum());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "strict": true, "experimentalDecorators": true } }
