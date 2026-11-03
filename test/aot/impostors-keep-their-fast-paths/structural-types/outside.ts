import { makeParcels, type Parcel } from "./described";
import stock from "./stock.json";

function postageOf(parcel: Parcel): number {
  return parcel.parcelWeight * parcel.parcelZone;
}

function aDeclarationFileThatTellsTheTruth(): () => number {
  const parcels = makeParcels(100);
  return function turnOfADeclarationFileThatTellsTheTruth() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += postageOf(parcels[i]);
    return total;
  };
}

function anImportedJsonFile(): () => number {
  return function turnOfAnImportedJsonFile() {
    let total = 0;
    for (let round = 0; round < 25; round++) for (const item of stock.items) total += item.amount * item.unit;
    return total;
  };
}

export const cases = {
  "16 a declaration file that tells the truth about a JavaScript module": aDeclarationFileThatTellsTheTruth,
  "16 an imported JSON file": anImportedJsonFile,
};
