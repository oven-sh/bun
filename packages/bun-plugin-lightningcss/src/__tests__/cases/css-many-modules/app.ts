import appStyles from "./app.module.css";
import { Component } from "./component";
import testStyles from "./test.module.css";

Component();
console.log("app with many css modules");
console.log(testStyles.test);
console.log(appStyles.app);
