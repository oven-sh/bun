import BunDatabase, { Bun, BunType } from "./bun-database";

export default class BunService {
  db: BunDatabase;

  constructor(db: BunDatabase) {
    this.db = db;
  }

  getBuns() {
    return this.db.getBuns();
  }

  getBun(id: string) {
    return this.db.getBun(id);
  }
  
  createBun(type: BunType) {
    this.db.createBun(type);
  }

  updateBun(bun: Bun) {
    this.db.updateBun(bun);
  }

  deleteBun(id: string) {
    this.db.deleteBun(id);
  }
}
