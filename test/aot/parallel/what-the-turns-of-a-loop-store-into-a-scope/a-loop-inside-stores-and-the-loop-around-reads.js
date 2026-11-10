function run(rows) {
  let total = 0,
    widest = 0,
    seen = "";
  const note = text => {
    seen = seen + text;
  };
  try {
    for (let r = 0; r < rows.length; r++) {
      let width = 0;
      for (let i = 0; i < rows[r].length; i++) {
        width = width + rows[r][i];
        if (width > widest) widest = width;
      }
      total = total + width;
      if (width === 0) note("-");
      else note(String(width));
    }
  } finally {
    note("!");
  }
  return [total, widest, seen].join();
}
console.log(run([[1, 2], [], [5], [0, 0], [3, 3, 3]]), run([]));
