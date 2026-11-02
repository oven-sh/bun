// The compiler options say that fields are assigned. A class has a field under a name, in brackets, that --define replaces by a string or a number, beside other fields. The class above it has a setter under one of the names.
// Flags: --define TEXT="text" --define COUNT=7
// Reference: bun build --compile
declare const TEXT: "text";
declare const COUNT: 7;

class Above {}
for (const name of ["text", "7", "y"]) {
  Object.defineProperty(Above.prototype, name, {
    set(value: unknown) {
      console.log("set", name, "to", value);
    },
  });
}

class UnderText extends Above {
  [TEXT] = 1;
  y = 2;
  optional?: number;
}
console.log(Object.keys(new UnderText()).join("+"));

class UnderCount extends Above {
  [COUNT] = 1;
  y = 2;
  optional?: number;
}
console.log(Object.keys(new UnderCount()).join("+"));
