// `list.push(a, ...other)`: what is written in front of the spread is evaluated first and may freeze, empty or fill the receiver.
function gather(deed, source) { const out = ["w"]; try { out.push(deed(out), ...source); return JSON.stringify(out); } catch (error) { return "threw " + error.name + " " + JSON.stringify(out); } }
console.log(gather(x => (Object.freeze(x), "froze"), [1]), gather(x => ((x.length = 0), "emptied"), [1]), gather(x => (x.push("filled"), "f"), [1]), gather(x => "plain", [1]));
