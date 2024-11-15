setInterval(() => {
    console.log("Cool");

    if (Math.random() > 0.5) {
        throw new Error("broken");
    }
}, 500);

console.log("Cool");

// process.on("uncaughtException", (e) => {
//     if (e instanceof SyntaxError) {
//         return;
//     }

//     console.warn(e);

//     setImmediate(() => {
//         process.exit(1);
//     });
// });
