const held = await import("./data.json");
console.log(Object.keys(held).join(), "|", Object.keys(held.default).join(), "|", JSON.stringify(held));
