// screen — display information via CEF's CefDisplay (views API).

import * as native from "./native";

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Display {
  id: number;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
}

interface RawDisplay extends Display {
  primary: boolean;
}

function displays(): RawDisplay[] {
  return native.screenInfo() as RawDisplay[];
}

export const screen = {
  getAllDisplays(): Display[] {
    return displays().map(({ primary, ...d }) => d);
  },

  getPrimaryDisplay(): Display {
    const all = displays();
    const primary = all.find((d) => d.primary) ?? all[0];
    if (!primary) throw new Error("no display available");
    const { primary: _ignored, ...d } = primary;
    return d;
  },
};
