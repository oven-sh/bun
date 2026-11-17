import pg from "pg";
import {
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  type NonAttribute,
  Sequelize,
  ValidationError,
} from "sequelize";

const sequelize = new Sequelize("postgres://user:pass@localhost:5432/db", { logging: false, dialectModule: pg });
class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare name: string;
  declare email: string;
  get shout(): NonAttribute<string> {
    return this.name.toUpperCase();
  }
}
User.init(
  {
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, validate: { isEmail: true } },
  },
  { sequelize, modelName: "user" },
);
const jane = User.build({ name: "Jane", email: "jane@example.com" });
console.log(jane instanceof User, jane.name, jane.shout, JSON.stringify(jane.toJSON()), User.tableName);
await jane.validate();
try {
  await User.build({ name: "Bad", email: "nope" }).validate();
} catch (error) {
  console.log(
    error instanceof ValidationError,
    (error as ValidationError).errors.map(each => `${each.path}: ${each.validatorKey}`).join(),
  );
}
const generator = (
  sequelize.getQueryInterface() as unknown as {
    queryGenerator: { selectQuery(table: string, options: object): string };
  }
).queryGenerator;
console.log(generator.selectQuery("users", { where: { id: 1, name: ["a", "b"] }, limit: 2 }));
await sequelize.close();
