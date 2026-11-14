// Commands with do and undo as closures over one document
function edit(text, steps) {
  const done = [];
  let redo = [];
  const run = (apply, revert) => {
    apply();
    done.push([apply, revert]);
    redo = [];
  };
  for (const step of steps) {
    if (step === "undo") {
      const command = done.pop();
      if (command) (command[1](), redo.push(command));
    } else if (step === "redo") {
      const command = redo.pop();
      if (command) (command[0](), done.push(command));
    } else {
      const before = text;
      run(() => (text = before + step), () => (text = before));
    }
  }
  return text + " " + done.length + redo.length;
}
console.log(edit("", ["a", "b", "undo", "c"]));
console.log(edit("x", ["y", "undo", "undo", "redo"]));
console.log(edit("q", []));
