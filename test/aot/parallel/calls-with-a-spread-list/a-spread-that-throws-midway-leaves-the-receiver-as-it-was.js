// `list.push(a, ...other)`: the push never comes where reading the source throws: nothing of it, nor the written arguments, is appended.
function* failing() { yield 1; yield 2; throw new Error("midway"); }
function gather(source) { const out = ["w"]; try { out.push("a", ...source); } catch (error) { return [error.message, JSON.stringify(out)]; } finally { out.push("finally"); } return ["clean", JSON.stringify(out)]; }
console.log(gather(failing()).join(" "), gather([1, 2]).join(" "));
function inLoop(sources) { const out = []; const log = []; for (const source of sources) { try { out.push(log.length, ...source); } catch (error) { log.push(error.message + " at " + out.length); } } return JSON.stringify(out) + " " + log.join(","); }
console.log(inLoop([[1], failing(), [2, 3], failing(), []]));
