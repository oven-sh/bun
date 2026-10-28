import "pg";
import { DataTypes, Op, Sequelize } from "sequelize";
import { fakePostgres } from "./fake_pg.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const said: string[] = [];
const server = fakePostgres(seen);
const port = await listen(server);
const sequelize = new Sequelize("d", "u", "p", { host: "127.0.0.1", port, dialect: "postgres", ...({ databaseVersion: "16.0.0" } as object), logging: (text: string) => void said.push(text), pool: { max: 1 } });
const Person = sequelize.define("person", { id: { type: DataTypes.INTEGER, primaryKey: true }, name: { type: DataTypes.STRING, allowNull: false } }, { timestamps: false, freezeTableName: true });

console.log(JSON.stringify(Person.build({ id: 7, name: "x" }).toJSON()));
console.log(JSON.stringify(await Person.findAll({ where: { id: { [Op.gt]: 0 } }, raw: true })));
try { await Person.build({ id: 8 }).validate(); } catch (error) { console.log((error as Error).name, (error as Error).message); }
await sequelize.close();
server.close();
console.log(said.filter(text => text.includes("person")).join(" | "));
console.log("DONE");
