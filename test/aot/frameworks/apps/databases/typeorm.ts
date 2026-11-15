import "reflect-metadata";
import { Column, DataSource, Entity, OneToMany, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

@Entity()
class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column() firstName!: string;
  @Column({ default: 0 }) age!: number;
  @OneToMany(() => Photo, photo => photo.user, { cascade: true }) photos!: Photo[];
}
@Entity()
class Photo {
  @PrimaryGeneratedColumn() id!: number;
  @Column() url!: string;
  @ManyToOne(() => User, user => user.photos) user!: User;
}
// PlatformTools.load() requires the driver under a computed name, which no executable can follow: the option is made for bundlers.
const source = new DataSource({
  type: "sqljs",
  driver: require("sql.js"),
  synchronize: true,
  logging: false,
  entities: [User, Photo],
});
await source.initialize();
const user = new User();
user.firstName = "Timber";
user.age = 25;
user.photos = [Object.assign(new Photo(), { url: "me.jpg" })];
await source.manager.save(user);
const found = await source.getRepository(User).find({ where: { firstName: "Timber" }, relations: { photos: true } });
console.log(JSON.stringify(found), found[0] instanceof User, found[0].photos[0] instanceof Photo);
console.log(
  source
    .getRepository(User)
    .createQueryBuilder("user")
    .where("user.age > :age", { age: 18 })
    .getQueryAndParameters()
    .join(" | "),
);
console.log(
  Reflect.getMetadata("design:type", User.prototype, "firstName").name,
  source
    .getMetadata(User)
    .columns.map(column => column.propertyName)
    .join(),
);
await source.destroy();
