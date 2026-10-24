const box = { width: 1 };
Object.groupBy([box], () => "group").group[0].width = "wide";
console.log("width + 1 is", box.width + 1);
