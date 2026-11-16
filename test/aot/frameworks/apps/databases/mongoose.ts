import mongoose, { type InferSchemaType, Schema, model } from "mongoose";

const kittySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    age: { type: Number, min: 0 },
    tags: [String],
    born: { type: Date, default: () => new Date(0) },
  },
  {
    methods: {
      speak() {
        return `Meow name is ${this.name}`;
      },
    },
    virtuals: {
      loud: {
        get() {
          return this.name.toUpperCase();
        },
      },
    },
  },
);
type Kitty = InferSchemaType<typeof kittySchema>;
const Kitten = model("Kitten", kittySchema);
const fluffy = new Kitten({ name: "  fluffy ", age: "3", tags: ["a", 1] });
const plain: Kitty = fluffy.toObject();
console.log(
  fluffy.speak(),
  fluffy.loud,
  plain.age,
  typeof plain.age,
  plain.tags.join(),
  plain.born.toISOString(),
  mongoose.isValidObjectId(fluffy._id),
);
console.log(await fluffy.validate());
const bad: mongoose.Error.ValidationError | undefined = await new Kitten({ age: -1 }).validate().then(
  () => undefined,
  error => error,
);
console.log(
  bad?.name,
  Object.keys(bad?.errors ?? {})
    .sort()
    .join(),
  bad?.errors.age.kind,
  bad?.errors.name.message,
);
console.log(
  JSON.stringify(
    Kitten.find({ age: { $gte: 2 } })
      .sort("-name")
      .limit(3)
      .getFilter(),
  ),
  new mongoose.Types.ObjectId("507f1f77bcf86cd799439011").getTimestamp().toISOString(),
);
