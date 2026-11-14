export const hidden = value => { try { throw value; } catch (caught) { return caught; } };
export class Vessel {
  constructor(liters) { this.liters = liters; }
  describe() { return "vessel of " + this.liters; }
}
