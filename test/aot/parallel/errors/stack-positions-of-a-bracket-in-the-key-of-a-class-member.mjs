// Prints where an error at a member is reported that stands in the computed key of a class member, with its `[` at the start of a line. A key that is a constant with a name for its value is printed behind a dot, as `quiet().getter`, and the frame is at what is mapped in front of it. Any other key is printed in brackets, and the frame is at that `[`.

function quiet() {}
const key = () => "getter";
const inThisFile = /stack-positions-of-a-bracket-in-the-key-of-a-class-member/;
function show(label, run) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error) {
    const lines = String(error.stack)
      .split("\n")
      .filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", lines.map(line => /:(\d+:\d+)\)?$/.exec(line)[1]).join(" "));
  }
}
// prettier-ignore
{
show("the key of a method, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    [quiet()
      [name]]() {}
  };
});
show("the key of a method, by a constant that holds a text with a dash", () => {
  const name = "a-b";
  return class {
    [quiet()
      [name]]() {}
  };
});
show("the key of a method, by a call", () => {
  return class {
    [quiet()
      [key()]]() {}
  };
});
show("the key of a method, by a call behind a comment that holds the start of a comment", () => {
  return class {
    [quiet()
      [ /* a /* b */ key()]]() {}
  };
});
show("the key of a getter, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    get [quiet()
      [name]]() {
      return 1;
    }
  };
});
show("the key of a setter, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    set [quiet()
      [name]](value) {}
  };
});
show("the key of a static method, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    static [quiet()
      [name]]() {}
  };
});
show("the key of a generator, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    *[quiet()
      [name]]() {}
  };
});
show("the key of an async method, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    async [quiet()
      [name]]() {}
  };
});
show("the key of a field, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    [quiet()
      [name]] = 1;
  };
});
show("the key of a static field, by a constant that holds a name", () => {
  const name = "getter";
  return class {
    static [quiet()
      [name]] = 1;
  };
});
show("the key of a method of a class that is declared, by a constant that holds a name", () => {
  const name = "getter";
  class Named {
    [quiet()
      [name]]() {}
  }
  return Named;
});
show("the key of a method of a class that is declared, by a constant that holds a text with a dash", () => {
  const name = "a-b";
  class Named {
    [quiet()
      [name]]() {}
  }
  return Named;
});
}
