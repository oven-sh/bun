for (let round = 0; round < 2; round++) {
  for (const [label, box] of [["a literal", { width: 1 }]]) {
    let line = "round " + round + " | " + label + " -> ";
    try {
      line += JSON.stringify(box);
    } catch (error) {}
    console.log(line + (round ? " | again" : ""));
  }
}
