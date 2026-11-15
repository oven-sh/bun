process.on("warning", warning => console.log("heard", warning.name));
let rounds = 0;
const bell = setInterval(() => { if (++rounds === 2) clearInterval(bell); console.log("rang", rounds); }, -7);
