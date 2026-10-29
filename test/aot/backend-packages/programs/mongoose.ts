import mongoose from "mongoose";
import { fakeMongo } from "./fake_mongo.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakeMongo(seen);
const port = await listen(server);
const schema = new mongoose.Schema(
  { _id: Number, name: { type: String, required: true }, age: { type: Number, min: 0 } },
  { autoIndex: false, autoCreate: false, versionKey: false, virtuals: { shout: { get(this: { name: string }) { return this.name.toUpperCase(); } } } },
);
const Person = mongoose.model("Person", schema);
await mongoose.connect(`mongodb://127.0.0.1:${port}/d?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
await Person.create({ _id: 1, name: "ada", age: 36 });
const found = await Person.find({ name: "ada" });
console.log(found.map(person => person.shout + " " + person.age).join(), JSON.stringify(found[0]!.toObject()));
try { await new Person({ _id: 3, age: -1 }).validate(); } catch (error) { console.log(Object.keys((error as mongoose.Error.ValidationError).errors).sort().join()); }
await mongoose.disconnect();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
