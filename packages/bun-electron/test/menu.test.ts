// Ported from Electron's spec/api-menu-spec.ts and api-menu-item-spec.ts
// (template building, lookup, click dispatch — the non-OS-rendering subset).

import { describe, expect, test } from "bun:test";
import { Menu, MenuItem } from "../src/index.ts";

describe("Menu module", () => {
  describe("Menu.buildFromTemplate", () => {
    test("should be able to attach extra fields", () => {
      const menu = Menu.buildFromTemplate([{ label: "text", extra: "field" } as never]);
      expect((menu.items[0] as never as { extra: string }).extra).toBe("field");
    });

    test("should be able to accept only props", () => {
      const menu = Menu.buildFromTemplate([{ label: "one" }, { label: "two" }]);
      expect(menu.items.length).toBe(2);
      expect(menu.items[0].label).toBe("one");
      expect(menu.items[1].label).toBe("two");
    });

    test("throws when the template is not an array", () => {
      expect(() => Menu.buildFromTemplate("hello" as never)).toThrow(/must be an array/);
    });

    test("builds nested submenus from templates", () => {
      const menu = Menu.buildFromTemplate([
        { label: "File", submenu: [{ label: "Open" }, { type: "separator" }, { label: "Close" }] },
      ]);
      expect(menu.items[0].type).toBe("submenu");
      expect(menu.items[0].submenu!.items.length).toBe(3);
      expect(menu.items[0].submenu!.items[1].type).toBe("separator");
    });
  });

  describe("Menu.getMenuItemById", () => {
    test("returns the item with the given id", () => {
      const menu = Menu.buildFromTemplate([
        { label: "View", id: "view" },
        { label: "Help", id: "help", submenu: [{ label: "About", id: "about" }] },
      ]);
      expect(menu.getMenuItemById("view")!.label).toBe("View");
      expect(menu.getMenuItemById("about")!.label).toBe("About");
      expect(menu.getMenuItemById("missing")).toBeNull();
    });
  });

  describe("Menu.insert", () => {
    test("should store item in position specified", () => {
      const menu = Menu.buildFromTemplate([{ label: "1" }, { label: "2" }, { label: "3" }]);
      menu.insert(0, new MenuItem({ label: "inserted" }));
      expect(menu.items[0].label).toBe("inserted");
      expect(menu.items.length).toBe(4);
    });

    test("throws for out-of-range positions", () => {
      const menu = new Menu();
      expect(() => menu.insert(5, new MenuItem({ label: "x" }))).toThrow(RangeError);
    });
  });

  describe("Menu.append", () => {
    test("adds the item to the end", () => {
      const menu = Menu.buildFromTemplate([{ label: "first" }]);
      menu.append(new MenuItem({ label: "last" }));
      expect(menu.items.at(-1)!.label).toBe("last");
    });
  });

  describe("Menu.setApplicationMenu", () => {
    test("getApplicationMenu returns the set menu", () => {
      const menu = Menu.buildFromTemplate([{ label: "App" }]);
      Menu.setApplicationMenu(menu);
      expect(Menu.getApplicationMenu()).toBe(menu);
      Menu.setApplicationMenu(null);
      expect(Menu.getApplicationMenu()).toBeNull();
    });
  });
});

describe("MenuItem module", () => {
  test("clicking a normal item invokes the click handler with the item", () => {
    const clicks: MenuItem[] = [];
    const item = new MenuItem({
      label: "hello",
      click: (menuItem) => {
        clicks.push(menuItem);
      },
    });
    item.click();
    expect(clicks[0]).toBe(item);
  });

  test("clicking a checkbox toggles checked", () => {
    const item = new MenuItem({ type: "checkbox", label: "check me" });
    expect(item.checked).toBe(false);
    item.click();
    expect(item.checked).toBe(true);
    item.click();
    expect(item.checked).toBe(false);
  });

  test("radio items uncheck their group siblings", () => {
    const menu = Menu.buildFromTemplate([
      { type: "radio", label: "a", checked: true },
      { type: "radio", label: "b" },
      { type: "separator" },
      { type: "radio", label: "c", checked: true },
    ]);
    menu.items[1].click();
    expect(menu.items[0].checked).toBe(false);
    expect(menu.items[1].checked).toBe(true);
    // The separator bounds the radio group; "c" is unaffected.
    expect(menu.items[3].checked).toBe(true);
  });

  test("roles provide default labels", () => {
    expect(new MenuItem({ role: "copy" }).label).toBe("Copy");
    expect(new MenuItem({ role: "quit" }).label).toBe("Quit");
  });

  test("defaults: enabled, visible, type normal", () => {
    const item = new MenuItem({ label: "defaults" });
    expect(item.enabled).toBe(true);
    expect(item.visible).toBe(true);
    expect(item.type).toBe("normal");
  });

  test("items with a submenu get type submenu", () => {
    const item = new MenuItem({ label: "parent", submenu: [{ label: "child" }] });
    expect(item.type).toBe("submenu");
    expect(item.submenu!.items[0].label).toBe("child");
  });
});
