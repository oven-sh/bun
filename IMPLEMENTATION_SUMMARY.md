# Implementação: mock.restoreModule()

## 🎯 Objetivo

Implementar funcionalidade para restaurar módulos mockados no test runner do Bun, resolvendo as issues:
- #7823 - Restore mock.module using mock.restore not work as expect
- #12823 - Bun mocks to be scoped to test file
- #5391 - Mocks aren't automatically reset between tests

## 📝 Problema

Atualmente no Bun 1.3.4:
- `mock.module()` cria mocks que persistem entre testes
- `mock.restore()` **não** afeta módulos mockados (apenas funções)
- Não existe forma de desmocar um módulo específico
- Não existe forma de desmocar todos os módulos

## ✅ Solução Implementada

### Nova API

```typescript
import { mock } from "bun:test";

// Restaurar módulo específico
mock.restoreModule("./my-module");

// Restaurar TODOS os módulos mockados
mock.restoreModule();

// Restaurar tudo (funções mockadas + módulos mockados)
mock.restore();
```

### Arquitetura

#### 1. C++ (`src/bun.js/bindings/BunPlugin.cpp`)

**Função Helper:**
```cpp
static void restoreSingleModuleMock(Zig::GlobalObject* globalObject, const WTF::String& specifier)
```
- Remove o mock do `virtualModules` HashMap
- Remove do ESM registry (`esmRegistryMap`)
- Remove do CJS cache (`requireMap`)

**Função Exportada:**
```cpp
JSC_DEFINE_HOST_FUNCTION(JSMock__jsRestoreModuleMock, ...)
```
- Aceita 0 argumentos: restaura TODOS os módulos
- Aceita 1 argumento (string): restaura módulo específico
- Resolve o caminho do módulo usando a mesma lógica de `mock.module()`
- Suporta caminhos relativos, absolutos e URLs file://

#### 2. Zig (`src/bun.js/test/jest.zig`)

**Binding extern:**
```zig
extern fn JSMock__jsRestoreModuleMock(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
```

**Função wrapper:**
```zig
fn jsRestoreMocks(globalObject: *JSGlobalObject, callframe: *CallFrame) callconv(jsc.conv) JSValue
```
- Chama `JSMock__jsRestoreAllMocks()` (restaura funções)
- Chama `JSMock__jsRestoreModuleMock()` (restaura módulos)
- Retorna `undefined`

**Exposição na API:**
- `mock.restore()` → `jsRestoreMocks` (restaura tudo)
- `mock.restoreModule()` → `JSMock__jsRestoreModuleMock` (só módulos)

## 🧪 Testes

Arquivo: `test/js/bun/test/mock/mock-restore-module.test.ts`

### Cenários Cobertos

1. ✅ Restaurar módulo específico
2. ✅ Restaurar todos os módulos
3. ✅ Restaurar com caminhos relativos
4. ✅ Mockar múltiplas vezes e restaurar
5. ✅ `mock.restore()` restaura funções E módulos
6. ✅ Restaurar módulo inexistente não causa erro
7. ✅ Restaurar sem mocks não causa erro
8. ✅ ESM e CJS são ambos restaurados

## 📊 Mudanças nos Arquivos

| Arquivo | Linhas | Descrição |
|---------|--------|-----------|
| `src/bun.js/bindings/BunPlugin.cpp` | +114 | Implementação C++ |
| `src/bun.js/test/jest.zig` | +12 | Bindings Zig |
| `test/js/bun/test/mock/mock-restore-module.test.ts` | +186 | Suite de testes |

## 🔧 Como Funciona

### Fluxo de Restauração

```
mock.restoreModule("./module")
         ↓
JSMock__jsRestoreModuleMock() [C++]
         ↓
Resolve o caminho do módulo
         ↓
restoreSingleModuleMock()
         ↓
┌─────────────────────────┐
│ 1. Remove de            │
│    virtualModules map   │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│ 2. Remove de            │
│    ESM registry         │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│ 3. Remove de            │
│    CJS requireMap       │
└─────────────────────────┘
         ↓
✅ Próxima importação carrega o módulo original
```

### Exemplo Prático

```typescript
import { test, expect, mock } from "bun:test";

test("demonstração de restore", async () => {
  // 1. Importar original
  const { getValue } = await import("./my-module");
  expect(getValue()).toBe("original"); // ✓

  // 2. Mockar
  mock.module("./my-module", () => ({ getValue: () => "mocked" }));
  expect(getValue()).toBe("mocked"); // ✓

  // 3. Restaurar
  mock.restoreModule("./my-module");

  // 4. Re-importar (limpar cache primeiro)
  delete require.cache[require.resolve("./my-module")];
  const restored = await import("./my-module" + "?v=1");
  expect(restored.getValue()).toBe("original"); // ✓
});
```

## 🚀 Compilação e Teste

```bash
# 1. Instalar dependências de build
sudo apt install -y cmake ninja-build clang-16 lld-16

# 2. Instalar dependências Node
bun install

# 3. Compilar e testar
bun bd test test/js/bun/test/mock/mock-restore-module.test.ts
```

## 📚 Compatibilidade

- ✅ ESM (import/export)
- ✅ CJS (require/module.exports)
- ✅ Caminhos relativos (`./module`)
- ✅ Caminhos absolutos (`/path/to/module`)
- ✅ URLs file:// (`file:./module`)
- ✅ Pacotes npm (`lodash`)

## 🎯 Benefícios

1. **Isolamento de testes** - mocks não vazam entre testes
2. **API consistente** - `mock.restore()` agora restaura TUDO
3. **Controle granular** - `mock.restoreModule(path)` para módulos específicos
4. **Compatibilidade** - funciona com ESM e CJS
5. **Segurança** - não causa crashes (diferente de `Bun.plugin.clearAll()`)

## 🔗 Issues Relacionadas

- Resolve: #7823, #12823, #5391
- Relacionado: #5356 (jest.resetModules), #16140 (vi.mock)

## 👥 Autor

Implementado via Claude Code

## 📅 Data

2025-01-05
