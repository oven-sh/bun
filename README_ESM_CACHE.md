# ESM Bytecode Cache - Quick Start

## 概要

BunのESMモジュールバイトコードキャッシング機能の実装です。この機能により、モジュールの解析（パース）フェーズをスキップし、モジュールロード時間を大幅に短縮します。

## 実装状況

### ✅ 完了
- モジュールメタデータのシリアライゼーション
- バイナリフォーマット設計
- Zigバインディング
- テストファイル
- ドキュメント

### 🚧 未実装
- デシリアライゼーション（キャッシュから復元）
- ModuleLoader統合
- キャッシュストレージ
- CLIフラグ

## ファイル一覧

### 実装ファイル
- `src/bun.js/bindings/ZigSourceProvider.cpp` - メタデータシリアライゼーション
- `src/bun.js/bindings/CachedBytecode.zig` - Zigバインディング

### テストファイル
- `test/js/bun/module/esm-bytecode-cache.test.ts` - 統合テスト
- `test-esm-cache.js`, `test-lib.js` - 手動テスト

### ドキュメント
- `ESM_BYTECODE_CACHE.md` - 技術仕様
- `IMPLEMENTATION_STATUS.md` - 実装状況詳細
- `ESM_CACHE_SUMMARY.md` - 実装サマリー
- `FINAL_REPORT.md` - 最終レポート
- `README_ESM_CACHE.md` - このファイル

## ビルド方法

```bash
bun run build:local
```

## テスト方法

```bash
# ビルド完了後
bun bd test test/js/bun/module/esm-bytecode-cache.test.ts

# または手動テスト
bun bd test-esm-cache.js
```

## 技術的なポイント

### シリアライゼーションフォーマット

```
Magic: "BMES" (0x424D4553)
Version: 1
Data:
  1. Module Requests (依存関係)
  2. Import Entries
  3. Export Entries
  4. Star Exports
  5. Bytecode
```

### API

**C++**:
```cpp
extern "C" bool generateCachedModuleByteCodeWithMetadata(
    BunString* sourceProviderURL,
    const Latin1Character* inputSourceCode,
    size_t inputSourceCodeSize,
    const uint8_t** outputByteCode,
    size_t* outputByteCodeSize,
    JSC::CachedBytecode** cachedBytecodePtr
);
```

**Zig**:
```zig
pub fn generateForESMWithMetadata(
    sourceProviderURL: *bun.String,
    input: []const u8
) ?struct { []const u8, *CachedBytecode }
```

## 次のステップ

1. **ビルド完了確認** - コンパイルエラーがないか確認
2. **基本テスト** - シリアライゼーションが動作するか確認
3. **デシリアライゼーション実装** - キャッシュから復元する機能
4. **ModuleLoader統合** - 実際にキャッシュを使用
5. **パフォーマンステスト** - 速度改善を測定

## トラブルシューティング

### ビルドエラー

コンパイルエラーが発生した場合：
1. WTF/JSC APIの使用方法を確認
2. 既存コードのパターンに従う
3. メモリ管理に注意（RefPtr, mi_malloc）

### テスト失敗

1. `bun bd test` を使用（`bun test` ではない）
2. ビルドが最新か確認
3. テストログを確認

## 貢献

この実装はまだ実験的段階です。以下の分野で貢献を歓迎します：

- デシリアライゼーションの実装
- キャッシュストレージの設計
- パフォーマンスベンチマーク
- バグ修正

## ライセンス

Bunと同じライセンス (MIT) に従います。

## 連絡先

- Issue: GitHubのIssue tracker
- PR: GitHubのPull Request

---

**実装日**: 2025-12-04
**ブランチ**: `bun-build-esm`
**ステータス**: 開発中（シリアライゼーション完了）
