// A flatMap callback increments a variable of the function around it, shifts the list and throws. The variable belongs to that call alone.
function note(v) {
  console.log(String(v));
}
function around(list) {
  let count = 0;
  try {
    note(
      list.flatMap((each, at) => {
        count++;
        if (at === 1) {
          list.shift();
        }
        if (at === 0) throw new Error("stop");
        return [at];
      }).length,
    );
  } catch (error) {
    note(count);
  }
}
around([, -0.25]);
around([-0.25, 0.5]);
