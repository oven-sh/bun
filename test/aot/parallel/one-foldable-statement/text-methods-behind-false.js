const isDev = false;
const R = (isDev ? "Dev Mode" : "Prod Mode").toLowerCase().split(" ").join("-");
console.log(R);
