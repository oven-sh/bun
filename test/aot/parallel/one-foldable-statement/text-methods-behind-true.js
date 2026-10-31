const isDev = true;
const R = (isDev ? "Dev Mode" : "Prod Mode").toLowerCase().split(" ").join("-");
console.log(R);
