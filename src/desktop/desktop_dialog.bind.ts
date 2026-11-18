import * as b from "../codegen/bindgen-lib.ts";
import {
  anything,
  flag,
  js,
  numberIfAny,
  ownedTextIfAny,
  ownedTexts,
  returnsObject,
  returnsPromise,
  text,
} from "./schema.ts";

export default b.module({ rustPath: "crate::dialog", feature: "Desktop", isCold: true, membersInTable: false });

const path = b.string.utf8.owned.optional;

export const FileFilterInit = b.dictionary({ name: path, extensions: ownedTexts });
export const FileDialogInit = b.dictionary(
  {
    title: path,
    message: path,
    buttonLabel: path,
    defaultPath: path,
    filters: b.array(FileFilterInit).nullable,
    properties: ownedTexts.nullable,
  },
  { fromJS: true },
);
export const MessageBoxInit = b.dictionary(
  {
    type: { type: ownedTextIfAny, rustName: "kind" },
    title: ownedTextIfAny,
    message: b.string.loose.utf8.owned.nullable,
    detail: ownedTextIfAny,
    buttons: b.array(b.string.loose.utf8.owned).nullable,
    defaultId: numberIfAny,
    cancelId: numberIfAny,
    checkboxLabel: ownedTextIfAny,
    checkboxChecked: flag,
    signal: b.any.falsyAsNull,
  },
  { fromJS: true },
);

const args = { window: anything, options: anything };

export const DesktopDialog = b.interface("DesktopDialog", {
  ofModule: true,
  name: "Dialog",
  namespace: true,
  static: {
    showOpenDialog: { args, ...returnsPromise },
    showOpenDialogSync: { args, ...returnsObject },
    showSaveDialog: { args, ...returnsPromise },
    showSaveDialogSync: { args, returns: b.string.utf8, ...js },
    showMessageBox: { args, ...returnsPromise },
    showMessageBoxSync: { args, returns: b.i32, ...js },
    showErrorBox: { args: { title: text, content: text }, ...js },
    showCertificateTrustDialog: { args, ...returnsPromise },
  },
});
