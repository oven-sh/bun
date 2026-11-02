export interface Parcel {
  parcelWeight: number;
  parcelZone: number;
}

export function makeParcels(count: number): Parcel[];
