function run(sources) {
  const listeners = new Set(), said = [];
  for (let i = 0; i < sources.length; i++) {
    said.push(i);
    let kept;
    const made = { ...sources[i], stop: (kept = () => i) };
    listeners.add(kept);
    said.push(listeners.delete(made.stop));
  }
  return said.join(" ") + " " + listeners.size;
}
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`);
