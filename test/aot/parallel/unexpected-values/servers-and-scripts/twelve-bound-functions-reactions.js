// Twelve bound functions are the reactions of promises.
function report(id, value) {
  console.log(this.name, id, value);
}

const context = { name: "context" };
for (let i = 0; i < 12; i++) Promise.resolve(i * 10).then(report.bind(context, i));
