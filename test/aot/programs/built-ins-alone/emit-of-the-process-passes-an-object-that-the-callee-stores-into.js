const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
process.on("ready", target);
process.emit("ready", box);
console.log(typeof box.value, box.value.length);
