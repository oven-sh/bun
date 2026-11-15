process.on("warning", warning => console.log("heard", warning.name, warning.message));
setTimeout(() => console.log("rang"), NaN);
