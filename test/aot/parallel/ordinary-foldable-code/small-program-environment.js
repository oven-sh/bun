const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
const isTest = NODE_ENV === "test";
const logLevel = isProduction ? "warn" : isTest ? "silent" : "debug";
const apiUrl = isProduction ? "https://api.example.com" : "http://localhost:3000";
console.log({ isProduction, isTest, logLevel, apiUrl });
