                .e_array => |arr| {
                    if (p.options.features.minify_syntax) {
                        if (strings.eqlComptime(name, "length")) {
                            var has_spread = false;
                            for (arr.items.slice()) |item| {
                                if (item.data == .e_spread) {
                                    has_spread = true;
                                    break;
                                }
                            }
                            if (!has_spread and p.exprCanBeRemovedIfUnused(&target)) {
                                return p.newExpr(E.Number{ .value = @floatFromInt(arr.items.len) }, loc);
                            }
                        }
                    }
                },
