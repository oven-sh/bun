export default {
  remoteWindow: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopRemoteWindow", 2),
  windowProperties: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopWindowProperties", 2),
  facade: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopFacade", 2),
  makeEnumerable: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopMakeEnumerable", 1),
  undetectable: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopUndetectable", 2),
  windowOf: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopWindowOf", 1),
  callingWindow: $newCppFunction("DesktopWindow.cpp", "jsFunctionDesktopCallingWindow", 1),
};
