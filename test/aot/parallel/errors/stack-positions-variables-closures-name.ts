// Each function declares a variable, and a conversion right behind the declaration asks where its caller stands. A closure names the variable in a
// statement that has nothing to run, for which Bun's transpiler prints nothing, so in the text that runs no closure may see the variable.
function frames(): string {
  return String(new Error("here").stack)
    .split("\n")
    .slice(2, 4)
    .map(line => line.trim().replace(/\(.*[\\/]/, "("))
    .join(" ; ");
}
function give(n: number): number {
  return n;
}
function show(f: () => string) {
  console.log(f.name, f());
}
show(function namedByTestOverEmptyArms() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    if (value) {
    } else {
    }
  };
  closure();
  return text + value;
});
show(function namedByTestOverNoArm() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    if (value) {
    }
  };
  closure();
  return text + value;
});
show(function namedByTestOverTestOverEmptyArms() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    if (value) {
      if (value) {
      }
    } else {
      {
      }
    }
  };
  closure();
  return text + value;
});
show(function namedByStatement() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    value;
  };
  closure();
  return text + value;
});
show(function namedByStatementAndRead() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    value;
    return value;
  };
  return text + closure();
});
show(function readAndNamedByStatement() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    const read = value + 1;
    value;
    return read;
  };
  return text + closure();
});
show(function namedByStatementOfOneClosureAndReadByAnother() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const first = () => {
    value;
  };
  const second = () => value;
  first();
  return text + second();
});
show(function namedByTestOverArmThatRuns() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    if (value) {
      give(2);
    }
  };
  closure();
  return text + value;
});
show(function storedAgain() {
  let value = give(1);
  const first = `${{ toString: () => String(frames()) }}`;
  value = give(2);
  const second = `${{ toString: () => String(frames()) }}`;
  const closure = () => {
    if (value) {
    }
  };
  closure();
  return first + " | " + second + value;
});
show(function namedNowhereElse() {
  const value = give(1);
  const text = `${{ toString: () => String(frames()) }}`;
  return text + value;
});
