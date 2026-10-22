// The two functions that the Promise constructor of Bun's library hands the executor are in the executable and do their work: a value, a rejection, a thenable of the program.
new Promise(resolve => resolve(1)).then(value => console.log(value));
new Promise((resolve, reject) => reject(new Error("no"))).catch(error => console.log(error.message));
new Promise(resolve => resolve({ then(f) { f("thenable"); } })).then(value => console.log(value));
