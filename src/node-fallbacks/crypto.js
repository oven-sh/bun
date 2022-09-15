export * from "crypto-browserify";

// we deliberately reference crypto. directly here because we want to preserve the This binding
export var getRandomValues = (array) => {
  return crypto.getRandomValues(array);
};

export var randomUUID = () => {
  return crypto.randomUUID();
};
