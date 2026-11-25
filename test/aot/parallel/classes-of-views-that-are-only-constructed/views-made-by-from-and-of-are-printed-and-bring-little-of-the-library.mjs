// Uint8Array.from and Buffer.of construct the class that they are called on, and do nothing else with it. The classes are not let go for that, so what lies below and above them stays out of the executable.
// STATISTIC: ImageFunctionsEmitted <= 24
console.log(Uint8Array.from([1, 2]), Buffer.of(1, 2));
