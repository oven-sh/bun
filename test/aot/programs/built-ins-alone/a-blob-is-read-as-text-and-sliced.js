const blob = new Blob(["ab", "cd"], { type: "text/plain" });
console.log(blob.size + 1, blob.type.length, (await blob.text()).length, (await blob.slice(1, 3).text()).length);
